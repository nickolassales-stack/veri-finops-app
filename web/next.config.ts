import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Gera .next/standalone: imagem Docker minima, sem node_modules completo.
  output: "standalone",

  // node-postgres usa require dinamico; mantem fora do bundle do servidor.
  serverExternalPackages: ["pg"],

  // Nao anunciar a stack no header HTTP.
  poweredByHeader: false,

  reactStrictMode: true,

  // Em dev, o Next bloqueia recursos vindos de origem diferente de "localhost".
  // Sem isto, abrir por 127.0.0.1 quebra o HMR e as Server Actions redirecionam
  // em vez de executar. Nao tem efeito em producao.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
