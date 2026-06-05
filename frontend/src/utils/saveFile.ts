/**
 * Saves a Blob to the local file system.
 * If running inside a pywebview desktop environment, it uses the python api bridge.
 * Otherwise, it falls back to the standard browser anchor download.
 */
export async function saveBlob(blob: Blob, filename: string): Promise<boolean> {
  const pywebview = (window as any).pywebview;
  if (pywebview && pywebview.api && typeof pywebview.api.save_file === 'function') {
    try {
      const base64Data = await blobToBase64(blob);
      const success = await pywebview.api.save_file(filename, base64Data);
      return success;
    } catch (err) {
      console.error('Error saving file via pywebview:', err);
      // Fallback to browser download
    }
  }

  // Standard browser download fallback
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
  return true;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      // Extract the base64 part of the data URL (e.g. data:application/pdf;base64,...)
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
