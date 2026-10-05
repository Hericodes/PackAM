import { redirect } from "next/navigation";
import { auth } from "../../auth";
import { StudentNavbar } from "../../components/student/StudentNavbar";
import { PrintStudio } from "../../components/student/PrintStudio";
import { db } from "../../lib/db";
import { getStudentPrintWorkspace } from "../../lib/printing/service";

export default async function PrintingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login?callbackUrl=%2Fprinting");
  if (session.user.role !== "STUDENT") redirect("/unauthorized");

  const [locations, initialJob] = await Promise.all([
    db.savedLocation.findMany({
      where: { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, label: true, address: true, instructions: true, latitude: true, longitude: true },
    }),
    getStudentPrintWorkspace(session.user.id),
  ]);

  return (
    <>
      <StudentNavbar />
      <main className="min-h-screen bg-[#fffdf7] pb-8">
        <div className="packam-container py-7 sm:py-10">
          <div className="max-w-2xl">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-black/45">PackAM Printing</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">Print your document</h1>
            <p className="mt-2 text-sm leading-6 text-black/60 sm:text-base">
              Upload your PDF, choose how you want it printed, and we&apos;ll bring it to you.
            </p>
          </div>
          <PrintStudio
            locations={locations}
            initialJob={initialJob}
          />
        </div>
      </main>
    </>
  );
}
