import sharp from 'sharp';
import { writeFileSync } from 'fs';
import { join } from 'path';

const sizes = [16, 32, 48, 128];
const iconColor = '#4a9eff'; // Accent color

async function generateIcon(size) {
  // Create a simple colored square with rounded corners
  const svg = `
    <svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${size}" height="${size}" rx="${size * 0.2}" fill="${iconColor}"/>
      <text x="50%" y="50%" font-family="Arial" font-size="${size * 0.4}" 
            font-weight="bold" fill="white" text-anchor="middle" 
            dominant-baseline="central">V</text>
    </svg>
  `;

  const png = await sharp(Buffer.from(svg))
    .png()
    .toBuffer();

  return png;
}

async function generateAllIcons() {
  const iconsDir = join(process.cwd(), 'public', 'icons');
  
  for (const size of sizes) {
    const icon = await generateIcon(size);
    const filename = join(iconsDir, `icon-${size}.png`);
    writeFileSync(filename, icon);
    console.log(`Generated ${filename}`);
  }
  
  console.log('All icons generated successfully!');
}

generateAllIcons().catch(console.error);

