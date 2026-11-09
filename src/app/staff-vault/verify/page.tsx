import StaffVerification from "@/components/StaffVerification";

export default function AdminVerifyPage(props: { searchParams: Promise<{ error?: string }> }) {
  return <StaffVerification {...props} />;
}
