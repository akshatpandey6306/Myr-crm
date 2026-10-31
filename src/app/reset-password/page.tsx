import SecurityForm from '../auth/SecurityForm';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <SecurityForm mode="reset" token={token ?? ''} />;
}
