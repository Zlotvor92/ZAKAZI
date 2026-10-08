import { ServiceWorkerRegister } from "@/components/dashboard/service-worker-register";

export default function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      {children}
      <ServiceWorkerRegister />
    </>
  );
}
