/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{js,ts,jsx,tsx,html}",
  ],
  theme: {
    extend: {
      colors: {
        // Custom colors for the extension
        sidebar: {
          bg: '#1a1a1a',
          hover: '#2a2a2a',
          active: '#3a3a3a',
          border: '#333333',
        },
        accent: {
          DEFAULT: '#4a9eff',
          hover: '#3a8eef',
        }
      }
    },
  },
  plugins: [],
}

