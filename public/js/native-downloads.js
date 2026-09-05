(() => {
  let native;
  const plugin = () => {
    // The unbundled Android bridge exports Plugins, not registerPlugin.
    native ||= window.Capacitor?.Plugins?.ReleaseDownloads
      || window.Capacitor?.registerPlugin?.('ReleaseDownloads');
    if (!native) throw new Error('Chưa kết nối được bộ tải APK. Hãy mở lại ứng dụng.');
    return native;
  };
  const jobs = new Map();
  window.Phim4KNativeDownloads = {
    supported() { return /Phim4KTV/.test(navigator.userAgent) && window.Capacitor?.getPlatform?.() === 'android'; },
    async status() { return plugin().status(); },
    async open(button, url) {
      if (jobs.has(url)) return;
      let installing = false;
      const install = async () => {
        if (installing) return;
        installing = true;
        try {
          const result = await native.install();
          button.textContent = result.needsPermission ? 'Cho phép cài đặt, rồi bấm lại tại đây' : 'Mở lại màn cài đặt';
        } catch (error) { button.textContent = error.message || 'Không cài được APK'; }
        finally { installing = false; }
      };
      jobs.set(url, true);
      button.removeAttribute('href');
      button.textContent = 'Bắt đầu tải APK…';
      try {
        plugin();
        let state = await native.start({ url });
        for (let attempt = 0; attempt < 180; attempt++) {
          if (state.status === 'complete') { button.textContent = 'Đã tải xong · Bấm kiểm tra và cài đặt'; button.onclick = e => { e.preventDefault(); void install(); }; return; }
          if (state.status === 'failed' || state.status === 'missing') throw new Error('Tải thất bại · Bấm thử lại');
          button.textContent = state.percent >= 0 ? `Đang tải APK · ${state.percent}%` : 'Đang tải APK…';
          await new Promise(resolve => setTimeout(resolve, 5000));
          state = await native.status();
        }
        button.textContent = 'Tải nền đang tiếp tục · Bấm kiểm tra lại';
      } catch (error) { button.textContent = error.message || 'Tải lỗi · Bấm thử lại'; }
      finally { jobs.delete(url); }
    }
  };
})();
