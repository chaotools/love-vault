let loadPromise = null;

export function loadTencentMap(key) {
  if (window.TMap) return Promise.resolve(window.TMap);
  if (loadPromise) return loadPromise;
  if (!key) return Promise.reject(new Error('腾讯地图 Key 未配置'));
  loadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.async = true;
    script.src = 'https://map.qq.com/api/gljs?v=1.exp&key=' + encodeURIComponent(key);
    const timer = setTimeout(() => {
      loadPromise = null;
      reject(new Error('腾讯地图加载超时'));
    }, 15000);
    script.onload = () => {
      clearTimeout(timer);
      if (window.TMap) resolve(window.TMap);
      else { loadPromise = null; reject(new Error('腾讯地图 SDK 初始化失败')); }
    };
    script.onerror = () => {
      clearTimeout(timer);
      loadPromise = null;
      reject(new Error('腾讯地图 SDK 加载失败，请检查域名白名单'));
    };
    document.head.append(script);
  });
  return loadPromise;
}