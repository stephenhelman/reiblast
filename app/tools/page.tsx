import Image from 'next/image'
import Link from 'next/link'
import Card from '@/components/shared/Card'
import { LogoFull } from '@/components/shared/Logo'
import { tools } from '@/lib/tools'

export default function ToolsHomePage() {
  return (
    <main className="min-h-screen bg-black text-white flex items-center justify-center">
      <div className="max-w-5xl w-full mx-auto px-6 py-16">
        <div className="mb-12">
          <LogoFull size={36} />
        </div>

        <h1 className="text-2xl font-semibold mb-2">Your tools</h1>
        <p className="text-gray mb-10">Pick a tool to get started.</p>

        <div className="grid gap-8 sm:grid-cols-2">
          {tools.map((tool, index) => (
            <Card
              key={tool.href}
              className={`animate-fade-rise flex flex-col justify-between transition-[transform,box-shadow] duration-200 ease-out hover:-translate-y-1 hover:shadow-xl hover:shadow-black/40 active:translate-y-0 active:scale-[0.98] active:shadow-md motion-reduce:transition-none motion-reduce:hover:translate-y-0 motion-reduce:active:scale-100 ${
                index === 1 ? '[animation-delay:100ms]' : ''
              }`}
            >
              <div>
                <Image
                  src={tool.mark}
                  alt={tool.name}
                  height={32}
                  width={32}
                  className="mb-4"
                />
                <h2 className="text-lg font-semibold mb-2">{tool.name}</h2>
                <p className="text-gray text-sm mb-6">{tool.blurb}</p>
              </div>
              <Link
                href={tool.href}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-gold px-6 py-3 text-base font-semibold text-black transition-colors duration-150 hover:bg-gold-hover"
              >
                Launch
              </Link>
            </Card>
          ))}
        </div>
      </div>
    </main>
  )
}
