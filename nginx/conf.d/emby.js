//查看日志: "docker-compose logs -f --tail=10  | grep js:"
async function redirect2Pan(r) {
    //根据实际情况修改下面4个设置，必填
    const embyHost = 'http://192.168.1.100:8096'; //这里默认emby/jellyfin的地址是宿主机,要注意iptables给容器放行端口
    const embyMountPath = '/video/alist';  // rclone 的挂载目录(emby服务内的地址), 例如将od, gd挂载到/mnt目录下:  /mnt/onedrive  /mnt/gd ,那么这里 就填写 /mnt
    const alistToken = 'alist-******';      //alist token
    const alistApiPath = 'http://192.168.1.100:5244/api/fs/get'; //访问宿主机上5244端口的alist api, 要注意iptables给容 器放行端口

    //fetch mount emby/jellyfin file path
    const regex = /[A-Za-z0-9]+/g;
    const itemId = r.uri.replace('emby', '').replace(/-/g, '').match(regex)[1];
    let mediaSourceId = r.args.MediaSourceId;
    let api_key = r.args.api_key;
    if ((mediaSourceId === null) || (mediaSourceId === undefined)) {
        mediaSourceId = '';
    }
	
    //infuse用户需要填写下面的api_key, 感谢@amwamw968
    if ((api_key === null) || (api_key === undefined)) {
        api_key = '';//这里填自己的emby/jellyfin API KEY
        r.warn(`api key for Infuse: ${api_key}`);
    }

    const itemInfoUri = `${embyHost}/Items/${itemId}/PlaybackInfo?MediaSourceId=${mediaSourceId}&api_key=${api_key}`;
    r.warn(`请求路径 itemInfoUri: ${itemInfoUri}`);
    const embyRes = await fetchEmbyFilePath(itemInfoUri, r);
    if (embyRes.startsWith('error')) {
        r.error(embyRes);
        r.return(500, embyRes);
        return;
    }
    r.warn(`本地路径挂载路径 mount emby file path: ${embyRes}`);

    // 以下设置按需更改，每个人的需求都不一样，模仿就行了
	if(embyRes.includes(':35455/')){
		r.warn(`电视直播 本地代理 direct to: ${embyRes}`);
        r.internalRedirect("@backend");
        return;
	}

	if(embyRes.includes('m3u8')){
		r.warn(`电视直播 302 redirect to: ${embyRes}`);
        r.return(302, embyRes);
        return;
	}

	if(!embyRes.includes('alist')){
		r.warn(`本地视频 本地代理 direct to: ${embyRes}`);
        r.internalRedirect("@backend");
        return;
	}
	
    //fetch alist direct link
    const alistFilePath = embyRes.replace(embyMountPath, '');
    const alistRes = await fetchAlistPathApi(alistApiPath, alistFilePath, alistToken, r);
    if (!alistRes.startsWith('error') && !alistRes.includes('quark/Emby')) {
        r.warn(`alist 302 redirect to: ${alistRes}`);
        r.return(302, alistRes);
        return;
    }
    if (alistRes.startsWith('error401')) {
        r.error(alistRes);
        r.return(401, alistRes);
        return;
    }
    if (alistRes.startsWith('error404')) {
        const filePath = alistFilePath.substring(alistFilePath.indexOf('/', 1));
        const foldersRes = await fetchAlistPathApi(alistApiPath, '/', alistToken, r);
        if (foldersRes.startsWith('error')) {
            r.error(foldersRes);
            r.return(500, foldersRes);
            return;
        }
        const folders = foldersRes.split(',').sort();
        for (let i = 0; i < folders.length; i++) {
            r.warn(`try to fetch alist path from /${folders[i]}${filePath}`);
            const driverRes = await fetchAlistPathApi(alistApiPath, `/${folders[i]}${filePath}`, alistToken, r);
            if (!driverRes.startsWith('error')) {
                r.warn(`alist 302 redirect to: ${driverRes}`);
                r.return(302, driverRes);
                return;
            }
        }
        r.warn(`本地代理 not found direct ${alistRes}`);
        r.internalRedirect("@backend");
        return;

    }
    r.warn(`本地代理 not found direct ${alistRes}`);
    r.internalRedirect("@backend");
    return;
}

async function fetchAlistPathApi(alistApiPath, alistFilePath, alistToken, r) {
    const alistRequestBody = {
        "path": alistFilePath
    }
    try {
        const response = await ngx.fetch(alistApiPath, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json;charset=utf-8',
                'Authorization': alistToken
            },
            max_response_body_size: 65535,
            body: JSON.stringify(alistRequestBody)
        })
        if (response.ok) {
            const result = await response.json();
            let resultJsonString = JSON.stringify(result);
            r.warn(`alist result: ${resultJsonString}`);
            if (result === null || result === undefined) {
                return `error: alist_path_api response is null`;
            }
            if (result.message == 'success') {
                if (!result.data.is_dir) {
                    return result.data.raw_url;
                }
            }
            if (result.code == 401) {
                return `error401: alist_path_api ${result.message}`;
            }
            if (result.message.includes('account')) {
                return `error404: alist_path_api ${result.code} ${result.message}`;
            }
            if (result.message == 'file not found' || result.message == 'path not found') {
                return `error404: alist_path_api ${result.message}`;
            }
            return `error: alist_path_api ${result.code} ${result.message}`;
        }
        else {
            return `error: alist_path_api ${response.status} ${response.statusText}`;
        }
    } catch (error) {
        return (`error: alist_path_api fetchAlistFiled ${error}`);
    }
}

async function fetchEmbyFilePath(itemInfoUri, r) {
    try {
        const res = await ngx.fetch(itemInfoUri, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json;charset=utf-8',
                'Content-Length': 0,
            },
            max_response_body_size: 65535,
        });
        if (res.ok) {
            const result = await res.json();
            let resultJsonString = JSON.stringify(result);
            r.warn(`emby result: ${resultJsonString}`);
            if (result === null || result === undefined) {
                return `error: emby_api itemInfoUri response is null`;
            }
            return result.MediaSources[0].Path;
        }
        else {
            return (`error: emby_api ${res.status} ${res.statusText}`);
        }
    }
    catch (error) {
        return (`error: emby_api fetch mediaItemInfo failed,  ${error}`);
    }
}

export default { redirect2Pan };
