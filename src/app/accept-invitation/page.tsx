import SecurityForm from '../auth/SecurityForm';

export default async function AcceptInvitationPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <SecurityForm mode="invitation" token={token ?? ''} />;
}
