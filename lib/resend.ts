export async function sendWelcomeEmail(
  name: string,
  email: string,
): Promise<boolean> {
  console.log(`[Resend] sendWelcomeEmail → ${name} <${email}>`)
  // Phase 2: send via Resend SDK
  // const resend = new Resend(process.env.RESEND_API_KEY)
  // await resend.emails.send({ from: 'hello@reiblast.app', to: email, ... })
  return true
}
