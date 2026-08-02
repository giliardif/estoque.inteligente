/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Nunca expor a URL interna do backend direto no bundle do cliente sem o
  // prefixo NEXT_PUBLIC_ — variáveis sem esse prefixo ficam só no servidor.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1",
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
