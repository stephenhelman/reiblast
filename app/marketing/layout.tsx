import type { Metadata } from 'next'
import Nav from '@/components/marketing/Nav'
import Footer from '@/components/marketing/Footer'

export const metadata: Metadata = {
  title: 'REIblast — From List to Blast',
  description:
    'The wholesale operating system built for investors who text. Pipeline, sequences, contracts, and deal analysis — all in one place.',
}

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Nav />
      <main>{children}</main>
      <Footer />
      <script
        src="https://widgets.leadconnectorhq.com/loader.js"
        data-resources-url="https://widgets.leadconnectorhq.com/chat-widget/loader.js"
        data-widget-id="6a91db99bde3d5bf50985574"
      ></script>
    </>
  )
}
