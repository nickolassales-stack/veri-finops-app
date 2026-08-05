import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gera .next/standalone: imagem Docker minima, sem node_modules completo.
  output: "standalone",

  // node-postgres usa require dinamico; mantem fora do bundle do servidor.
  serverExternalPackages: ["pg"],

  // Nao anunciar a stack no header HTTP.
  poweredByHeader: false,

  reactStrictMode: true,
};

export default nextConfig;
