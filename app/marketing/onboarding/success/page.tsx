import { redirect } from 'next/navigation'

export default function OnboardingSuccess() {
  redirect('/onboarding-complete')
}
