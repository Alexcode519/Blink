import sharp from 'sharp'
import { mkdirSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dir = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dir, '../assets/store')
mkdirSync(OUT, { recursive: true })

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="500">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%"   stop-color="#0a0a1a"/>
      <stop offset="100%" stop-color="#0d0d2a"/>
    </linearGradient>
    <filter id="glow">
      <feGaussianBlur stdDeviation="12" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>

  <!-- Background -->
  <rect width="1024" height="500" fill="url(#bg)"/>

  <!-- Ambient glow orbs -->
  <circle cx="200" cy="250" r="180" fill="#4f6ef7" opacity="0.06"/>
  <circle cx="820" cy="250" r="180" fill="#4f6ef7" opacity="0.06"/>
  <circle cx="512" cy="250" r="220" fill="#4f6ef7" opacity="0.04"/>

  <!-- Eye icon (large, centred) -->
  <g transform="translate(370, 150) scale(0.55)" filter="url(#glow)">
    <path d="M256 152 C140 152 60 256 60 256 C60 256 140 360 256 360 C372 360 452 256 452 256 C452 256 372 152 256 152Z"
          fill="#4f6ef7" opacity="0.15"/>
    <path d="M80 256 C140 170 200 130 256 128 C312 130 372 170 432 256"
          fill="none" stroke="#4f6ef7" stroke-width="22" stroke-linecap="round"/>
    <path d="M80 256 C140 342 200 382 256 384 C312 382 372 342 432 256"
          fill="none" stroke="#4f6ef7" stroke-width="22" stroke-linecap="round"/>
    <circle cx="256" cy="256" r="80" fill="#4f6ef7"/>
    <circle cx="256" cy="256" r="44" fill="#0d0d1a"/>
    <circle cx="278" cy="232" r="18" fill="white" opacity="0.7"/>
  </g>

  <!-- App name -->
  <text x="512" y="330" font-family="system-ui, -apple-system, sans-serif"
        font-size="82" font-weight="700" fill="white" text-anchor="middle"
        letter-spacing="-2">Blink</text>

  <!-- Tagline -->
  <text x="512" y="382" font-family="system-ui, -apple-system, sans-serif"
        font-size="22" fill="#888" text-anchor="middle" letter-spacing="1">
    End-to-end encrypted messaging
  </text>

  <!-- Small lock icons -->
  <text x="430" y="383" font-family="system-ui" font-size="18" fill="#4f6ef7">🔒</text>
  <text x="576" y="383" font-family="system-ui" font-size="18" fill="#4f6ef7">🔒</text>
</svg>`

await sharp(Buffer.from(SVG)).resize(1024, 500).png()
  .toFile(join(OUT, 'feature-graphic-1024x500.png'))
console.log('✓ Feature graphic: 1024×500')
