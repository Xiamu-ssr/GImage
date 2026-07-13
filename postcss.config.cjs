const path = require('path');

// Vite 从仓库根目录加载 PostCSS；前端根目录在 frontend/，因此显式指向该配置。
module.exports = {
  plugins: {
    tailwindcss: { config: path.join(__dirname, 'frontend', 'tailwind.config.cjs') },
    autoprefixer: {},
  },
};
