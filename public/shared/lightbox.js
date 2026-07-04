/** 图片/视频大图预览。音乐没有可放大的画面,不接入 lightbox,直接用行内 <audio> 播放。 */
export function openLightbox(url, modality = 'image') {
  const lb = document.createElement('div');
  lb.className = 'lightbox';
  const media = modality === 'video'
    ? `<video src="${url}" controls autoplay playsinline></video>`
    : `<img src="${url}" />`;
  lb.innerHTML = `<span class="close">&times;</span>${media}`;
  lb.addEventListener('click', (e) => {
    if (e.target === lb || e.target.classList.contains('close')) lb.remove();
  });
  document.body.appendChild(lb);
}
