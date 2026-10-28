import { logoTargetSize } from "@/lib/domain/logo";

/**
 * Smanjuje logo u pregledaču pre slanja, pa skladište i javna strana dobijaju
 * datoteku od nekoliko desetina KB umesto originala sa telefona.
 *
 * Ako bilo šta ne uspe, vraća original: server ga i dalje proverava, a veliki
 * logo je bolji od logoa koji ne može da se pošalje.
 */
export async function shrinkLogo(file: File): Promise<File> {
  try {
    const bitmap = await createImageBitmap(file);
    const size = logoTargetSize(bitmap.width, bitmap.height);

    if (size.width === bitmap.width && size.height === bitmap.height) {
      bitmap.close();
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");

    if (!context) {
      bitmap.close();
      return file;
    }

    context.imageSmoothingQuality = "high";
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    bitmap.close();

    // Safari stariji od 17 ne ume da napravi WebP i tiho vrati PNG; PNG
    // čuva providnu pozadinu logoa, pa je i on dobar ishod.
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, "image/webp", 0.9);
    });

    if (!blob || blob.size >= file.size) {
      return file;
    }

    const extension = blob.type === "image/webp" ? "webp" : "png";

    return new File([blob], `logo.${extension}`, { type: blob.type });
  } catch {
    return file;
  }
}
