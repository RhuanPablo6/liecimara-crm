// Comprime a foto no próprio celular antes de enviar: 1600 px no lado maior (JPEG ~85%) + miniatura de 360 px.
// Fotos do iPhone (HEIC) chegam convertidas pelo navegador; a orientação EXIF é aplicada pelo createImageBitmap.

async function toBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((ok, fail) => canvas.toBlob((b) => (b ? ok(b) : fail(new Error('Não foi possível processar a foto'))), 'image/jpeg', quality));
}

async function base64(blob: Blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

function draw(src: ImageBitmap | HTMLImageElement, max: number) {
  const w0 = 'naturalWidth' in src ? src.naturalWidth : src.width;
  const h0 = 'naturalHeight' in src ? src.naturalHeight : src.height;
  const k = Math.min(1, max / Math.max(w0, h0));
  const c = document.createElement('canvas');
  c.width = Math.round(w0 * k);
  c.height = Math.round(h0 * k);
  const ctx = c.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

async function load(file: File): Promise<ImageBitmap | HTMLImageElement> {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }
}

export async function preparePhoto(file: File) {
  if (!file.type.startsWith('image/') && !/\.(heic|heif|jpe?g|png|webp)$/i.test(file.name)) throw new Error(`"${file.name}" não é uma imagem`);
  const src = await load(file);
  const full = draw(src, 1600);
  const thumb = draw(src, 360);
  const [fb, tb] = await Promise.all([toBlob(full, 0.85), toBlob(thumb, 0.75)]);
  return { data: await base64(fb), thumb: await base64(tb), mime: 'image/jpeg', width: full.width, height: full.height, size: fb.size };
}
