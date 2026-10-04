import { StudentNavbar } from "../../components/student/StudentNavbar";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <StudentNavbar />
      {children}
    </>
  );
}
