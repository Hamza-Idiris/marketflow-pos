/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Inter Variable"', 'Inter', 'system-ui', 'sans-serif'] },
      colors: {
        brand: {
          50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 500: '#3b82f6',
          600: '#2563eb', 700: '#1d4ed8', 800: '#1e40af',
        },
        surface: '#f8fafc',
        ink: { 900: '#0f172a', 700: '#334155', 500: '#64748b', 300: '#cbd5e1' },
      },
      borderRadius: { xl: '0.875rem' },
      boxShadow: { card: '0 1px 2px rgba(15,23,42,.05)' },
    },
  },
  plugins: [],
};
