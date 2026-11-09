import StaffVerification from "@/components/StaffVerification";

export default function ModeratorVerifyPage(props: { searchParams: Promise<{ error?: string }> }) {
  return <StaffVerification {...props} moderator />;
}
