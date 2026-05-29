/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@prisma/client", "bcryptjs"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "reiblast.app" },
      { protocol: "https", hostname: "tools.reiblast.app" },
      { protocol: "https", hostname: "app.reiblast.app" },
    ],
  },
};

export default nextConfig;
