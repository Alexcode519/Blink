import { Skia, ClipOp, ImageFormat, TileMode } from '@shopify/react-native-skia'
import FaceDetection from '@react-native-ml-kit/face-detection'

const BLUR_SIGMA = 28
const FACE_MARGIN_RATIO = 0.12
const JPEG_QUALITY = 85

// Faces near the frame edge or smaller than this fraction of the image are
// almost always false positives (e.g. patterns, logos) — skip blurring them.
const MIN_FACE_SIZE_RATIO = 0.01

// Throws on failure (e.g. ML Kit/Play Services unavailable) rather than
// swallowing errors — callers must not treat a failed check as "no faces
// found," since that would silently send an unchecked photo unblurred.
export async function detectFaces(uri) {
  const faces = await FaceDetection.detect(uri, { performanceMode: 'accurate' })
  return faces ?? []
}

function expandedRect(face, imgWidth, imgHeight) {
  const { left, top, width, height } = face.frame
  const mx = width * FACE_MARGIN_RATIO
  const my = height * FACE_MARGIN_RATIO
  const x0 = Math.max(0, left - mx)
  const y0 = Math.max(0, top - my)
  const x1 = Math.min(imgWidth, left + width + mx)
  const y1 = Math.min(imgHeight, top + height + my)
  return Skia.XYWHRect(x0, y0, x1 - x0, y1 - y0)
}

// Renders the image with a permanent Gaussian blur baked into the pixels over
// each detected face rect large enough to trust (see MIN_FACE_SIZE_RATIO).
// Returns a base64 JPEG string whenever ML Kit detected at least one face —
// even if every one was filtered out as too small to trust — so the caller
// always shows the sender a preview rather than silently auto-sending an
// unreviewed photo. Returns null only when there were no faces at all, or on
// decode failure.
export async function blurFacesInImage(uri, faces) {
  if (!faces?.length) return null

  const data = await Skia.Data.fromURI(uri)
  const image = Skia.Image.MakeImageFromEncoded(data)
  if (!image) return null

  const width = image.width()
  const height = image.height()
  const minDim = Math.min(width, height)
  const relevantFaces = faces.filter(f => Math.min(f.frame.width, f.frame.height) >= minDim * MIN_FACE_SIZE_RATIO)

  const surface = Skia.Surface.Make(width, height)
  if (!surface) return null
  const canvas = surface.getCanvas()
  canvas.drawImage(image, 0, 0)

  if (relevantFaces.length) {
    const blurPaint = Skia.Paint()
    blurPaint.setImageFilter(Skia.ImageFilter.MakeBlur(BLUR_SIGMA, BLUR_SIGMA, TileMode.Clamp))

    for (const face of relevantFaces) {
      const rect = expandedRect(face, width, height)
      const oval = Skia.Path.Make().addOval(rect)
      canvas.save()
      canvas.clipPath(oval, ClipOp.Intersect, true)
      canvas.drawImage(image, 0, 0, blurPaint)
      canvas.restore()
    }
  }

  const snapshot = surface.makeImageSnapshot()
  return snapshot.encodeToBase64(ImageFormat.JPEG, JPEG_QUALITY)
}
