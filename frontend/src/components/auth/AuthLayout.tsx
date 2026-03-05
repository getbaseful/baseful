import { Outlet } from "react-router-dom";
import { FloatingPaths } from "@/components/floating-paths";

export default function AuthLayout() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 min-h-screen items-center justify-center">
      <div className="h-full hidden lg:flex col-span-1 w-full">
        <div className="relative w-full hidden h-full flex-col border-r bg-secondary p-10 lg:flex dark:bg-secondary/20">
          <div className="absolute inset-0 bg-linear-to-b from-transparent via-transparent to-background" />
          <div className="flex flex-row gap-2 items-center">
            <img src="/logo.png" alt="Baseful Logo" width={24} height={24} />
            <h2 className="text-xl">Baseful</h2>
          </div>
          <div className="z-10 mt-auto">
            <blockquote className="space-y-2">
              <p className="text-lg">
                &ldquo;The open source, self hosted alternative to Neon.&rdquo;
              </p>
            </blockquote>
          </div>
          <div className="absolute inset-0">
            <FloatingPaths position={0} />
          </div>
        </div>
      </div>
      <div className="p-4 flex items-center justify-center">
        <div className="w-full max-w-md">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
