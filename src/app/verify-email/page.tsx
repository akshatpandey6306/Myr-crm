import SecurityForm from '../auth/SecurityForm';

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <SecurityForm mode="verify" token={token ?? ''} />;
}
