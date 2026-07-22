// Generates Blink app icons for Android and iOS from a shared SVG template.
// Usage: node scripts/generate-icons.mjs

import sharp from 'sharp'
import { writeFileSync, mkdirSync, readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const ROOT  = join(__dir, '..')

// ── Icon SVG design ──────────────────────────────────────────────────────────
// Dark background, blue eye shape representing "Blink", white pupil
const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- Background with rounded corners (clipped to square for mipmap) -->
  <rect width="512" height="512" rx="96" fill="#0d0d1a"/>

  <!-- Outer eye shape (blue) -->
  <path d="M256 152 C140 152 60 256 60 256 C60 256 140 360 256 360 C372 360 452 256 452 256 C452 256 372 152 256 152Z"
        fill="#4f6ef7" opacity="0.15"/>

  <!-- Eye lids - upper curve -->
  <path d="M80 256 C140 170 200 130 256 128 C312 130 372 170 432 256"
        fill="none" stroke="#4f6ef7" stroke-width="22" stroke-linecap="round"/>

  <!-- Eye lids - lower curve -->
  <path d="M80 256 C140 342 200 382 256 384 C312 382 372 342 432 256"
        fill="none" stroke="#4f6ef7" stroke-width="22" stroke-linecap="round"/>

  <!-- Iris -->
  <circle cx="256" cy="256" r="80" fill="#4f6ef7"/>

  <!-- Pupil -->
  <circle cx="256" cy="256" r="44" fill="#0d0d1a"/>

  <!-- Highlight -->
  <circle cx="278" cy="232" r="18" fill="white" opacity="0.7"/>

  <!-- Subtle lash lines top -->
  <line x1="256" y1="128" x2="256" y2="108" stroke="#4f6ef7" stroke-width="14" stroke-linecap="round"/>
  <line x1="200" y1="140" x2="188" y2="122" stroke="#4f6ef7" stroke-width="12" stroke-linecap="round" opacity="0.6"/>
  <line x1="312" y1="140" x2="324" y2="122" stroke="#4f6ef7" stroke-width="12" stroke-linecap="round" opacity="0.6"/>
</svg>`

const SIZES = {
  'mipmap-mdpi':    48,
  'mipmap-hdpi':    72,
  'mipmap-xhdpi':   96,
  'mipmap-xxhdpi':  144,
  'mipmap-xxxhdpi': 192,
}

const PLAY_STORE_SIZE = 512
const NOTIFICATION_SIZE = 24

// iOS AppIcon.appiconset — matches the slots already declared in Contents.json
// (classic per-scale iPhone format, not the newer single-1024 universal format).
const IOS_ICONS = [
  { filename: 'icon-20@2x.png',       size: 40   },
  { filename: 'icon-20@3x.png',       size: 60   },
  { filename: 'icon-29@2x.png',       size: 58   },
  { filename: 'icon-29@3x.png',       size: 87   },
  { filename: 'icon-40@2x.png',       size: 80   },
  { filename: 'icon-40@3x.png',       size: 120  },
  { filename: 'icon-60@2x.png',       size: 120  },
  { filename: 'icon-60@3x.png',       size: 180  },
  { filename: 'icon-1024.png',        size: 1024 },
]

async function generate() {
  const svgBuf = Buffer.from(SVG)

  // Android mipmap icons
  for (const [folder, size] of Object.entries(SIZES)) {
    const dir = join(ROOT, 'android/app/src/main/res', folder)
    mkdirSync(dir, { recursive: true })

    // Regular launcher icon
    await sharp(svgBuf).resize(size, size).png().toFile(join(dir, 'ic_launcher.png'))
    // Round launcher icon (same design, sharp handles clipping)
    await sharp(svgBuf).resize(size, size).png().toFile(join(dir, 'ic_launcher_round.png'))
    console.log(`✓ ${folder}: ${size}×${size}`)
  }

  // Play Store 512×512
  const playDir = join(ROOT, 'assets/store')
  mkdirSync(playDir, { recursive: true })
  await sharp(svgBuf).resize(PLAY_STORE_SIZE, PLAY_STORE_SIZE).png().toFile(join(playDir, 'icon-512.png'))
  console.log(`✓ Play Store icon: 512×512`)

  // Notification icon (white, small)
  const notifSvg = SVG.replace('#0d0d1a', 'transparent').replace(/#4f6ef7/g, 'white')
  await sharp(Buffer.from(notifSvg)).resize(NOTIFICATION_SIZE, NOTIFICATION_SIZE).png()
    .toFile(join(ROOT, 'android/app/src/main/res/drawable/ic_notification.png'))
  console.log(`✓ Notification icon: 24×24`)

  // iOS AppIcon.appiconset — App Store rejects icons with an alpha channel,
  // so flatten to the opaque background instead of a transparent PNG.
  const iosDir = join(ROOT, 'ios/Blink/Images.xcassets/AppIcon.appiconset')
  mkdirSync(iosDir, { recursive: true })
  for (const { filename, size } of IOS_ICONS) {
    await sharp(svgBuf).resize(size, size).flatten({ background: '#0d0d1a' }).png()
      .toFile(join(iosDir, filename))
    console.log(`✓ iOS ${filename}: ${size}×${size}`)
  }

  // Point Contents.json at the files we just generated. Derive the filename
  // straight from each slot's own size/scale (not a pixel-size lookup —
  // 40x40@3x and 60x60@2x are both 120px, so a size-keyed map collides).
  const contentsPath = join(iosDir, 'Contents.json')
  const contents = JSON.parse(readFileSync(contentsPath, 'utf8'))
  for (const img of contents.images) {
    img.filename = img.idiom === 'ios-marketing'
      ? 'icon-1024.png'
      : `icon-${img.size.split('x')[0]}@${img.scale}.png`
  }
  writeFileSync(contentsPath, JSON.stringify(contents, null, 2) + '\n')
  console.log('✓ Contents.json updated')

  console.log('\n🎉 All icons generated!')
}

generate().catch(console.error)
