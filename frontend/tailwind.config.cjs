const path = require('path');

/** @type {import('tailwindcss').Config} */
module.exports = {
  // Vite 从仓库根启动；使用绝对 glob 防止生产构建丢失工具类。
  content: [path.join(__dirname, 'index.html'), path.join(__dirname, 'src/**/*.{js,ts,jsx,tsx}')],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Barlow', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['Instrument Serif', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
};
