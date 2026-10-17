import { notFound, redirect } from "next/navigation";
import { auth } from "../../../../../auth";
import { PrintPaymentStatus } from "../../../../../components/student/PrintPaymentStatus";
import { getStudentPrintPaymentWorkspace } from "../../../../../lib/printing/service";

export default async function PrintPaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fprinting");
  if (session.user.role !== "STUDENT") redirect("/unauthorized");
  const { id } = await params;
  const workspace = await getStudentPrintPaymentWorkspace(session.user.id, id);
  if (!workspace) notFound();

  return (
    <>
      <main className="min-h-screen px-4 py-7 sm:py-10">
        <div className="mx-auto max-w-xl">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-black/45">PackAM Printing</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">Print payment</h1>
          <PrintPaymentStatus
            printJobId={workspace.id}
            paymentReference={workspace.payment.reference}
            initialStatus={workspace.payment.status}
            cashierUrl={workspace.payment.cashierUrl}
            snapshot={workspace.snapshot}
          />
        </div>
      </main>
    </>
  );
}
