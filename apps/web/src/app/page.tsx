import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { HeroHeader } from '@/components/landing/hero-header'
import { cn } from '@/lib/utils'
import {
  Phone,
  FileText,
  Globe,
  Clock,
  ChevronRight,
  Shield,
  MessageSquare,
  Headphones,
} from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'

const features = [
  {
    icon: Phone,
    title: 'File Claims by Phone',
    description:
      'Simply call and describe what happened. Bella guides you through the entire claims process conversationally.',
  },
  {
    icon: FileText,
    title: 'Upload Evidence via SMS',
    description:
      'Receive a secure link via SMS to upload photos and documents directly from your phone. No app required.',
  },
  {
    icon: Globe,
    title: 'Multilingual Support',
    description:
      'Speak in your preferred language. Bella understands and responds fluently in multiple languages.',
  },
  {
    icon: Clock,
    title: '24/7 Availability',
    description:
      'No hold times, no business hours. Bella is always ready to help — day, night, weekends, and holidays.',
  },
]

const capabilities = [
  { icon: Shield, label: 'Claims Processing' },
  { icon: MessageSquare, label: 'SMS Upload' },
  { icon: Globe, label: 'Multilingual' },
  { icon: Headphones, label: 'Voice AI' },
  { icon: Phone, label: 'Tap to Call' },
  { icon: Clock, label: '24/7 Available' },
  { icon: FileText, label: 'Policy Lookup' },
  { icon: Shield, label: 'Fraud Detection' },
  { icon: Phone, label: 'Instant Support' },
]

export default function LandingPage() {
  return (
    <>
      <HeroHeader />
      <main className="overflow-hidden">
        {/* Hero Section — Tailark veil design */}
        <section className="bg-background">
          <div className="relative py-32 md:pt-44">
            <div className="mask-radial-from-45% mask-radial-to-75% mask-radial-at-top mask-radial-[75%_100%] mask-t-from-50% lg:aspect-9/4 absolute inset-0 aspect-square lg:top-24 dark:opacity-5">
              <Image
                src="https://images.unsplash.com/photo-1556742049-0cfed4f6a45d?q=80&w=2268&auto=format&fit=crop"
                alt="Insurance support background"
                width={2268}
                height={1512}
                className="size-full object-cover object-top"
                priority
              />
            </div>
            <div className="relative z-10 mx-auto w-full max-w-5xl px-6">
              <div className="mx-auto max-w-xl text-center">
                <h1 className="text-balance font-serif text-4xl font-medium sm:text-5xl">
                  Insurance Support, Reimagined.
                </h1>
                <p className="text-muted-foreground mt-4 text-balance">
                  Meet Bella — your AI voice agent for insurance claims and
                  support. File claims, upload evidence, and get answers
                  instantly. Just call.
                </p>

                <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
                  <a
                    href="tel:+493075676653"
                    className={cn(
                      buttonVariants({ size: 'lg' }),
                      'pr-1.5'
                    )}
                  >
                    <Phone className="mr-2 size-4" />
                    <span className="text-nowrap">Call Bella Now</span>
                    <ChevronRight className="opacity-50" />
                  </a>
                  <Link
                    href="/login"
                    className={cn(
                      buttonVariants({ size: 'lg', variant: 'outline' })
                    )}
                  >
                    Admin Login
                  </Link>
                </div>
              </div>

              {/* Phone number card */}
              <div className="mx-auto mt-16 max-w-sm">
                <Card className="shadow-foreground/5 items-center px-8 py-6 text-center">
                  <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
                    Experience Bella now
                  </p>
                  <a
                    href="tel:+493075676653"
                    className="font-display text-3xl font-bold tracking-tight transition-colors hover:text-primary/70 sm:text-4xl"
                  >
                    +49 30 7567 6653
                  </a>
                  <p className="text-muted-foreground text-sm">
                    Tap to call • Free of charge
                  </p>
                </Card>
              </div>

              {/* Trust capabilities grid — Tailark integration pill style */}
              <div className="mx-auto mt-20 max-w-xl">
                <div className="grid scale-95 grid-cols-3 gap-x-12 gap-y-4">
                  {capabilities.map((cap, i) => (
                    <div
                      key={i}
                      className={
                        i % 3 === 0
                          ? 'ml-auto'
                          : i % 3 === 2
                            ? 'ml-auto'
                            : ''
                      }
                    >
                      <Card
                        className={cn(
                          'shadow-foreground/10 flex h-8 w-fit flex-row items-center gap-2 rounded-xl px-3 py-0 sm:h-10 sm:px-4',
                          (i === 0 || i === 2 || i === 4 || i === 6 || i === 8) && 'blur-[2px]'
                        )}
                      >
                        <cap.icon className="size-3 sm:size-4" />
                        <span className="text-nowrap font-medium max-sm:text-xs">
                          {cap.label}
                        </span>
                      </Card>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Trust indicators */}
        <section className="border-t py-8">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-6 text-sm text-muted-foreground">
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-green-500" />
              Available 24/7
            </span>
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-blue-500" />
              Multilingual
            </span>
            <span className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-purple-500" />
              Claims &amp; Support
            </span>
          </div>
        </section>

        {/* Features Section */}
        <section className="py-16 md:py-32">
          <div className="mx-auto max-w-5xl px-6">
            <div className="mb-14 text-center">
              <h2 className="text-balance font-serif text-3xl font-medium md:text-4xl">
                How Bella Works
              </h2>
              <p className="text-muted-foreground mt-4">
                Simple, fast, and always available. No apps to download, no
                forms to fill.
              </p>
            </div>

            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {features.map((feature) => (
                <Card
                  key={feature.title}
                  className="group/feature p-6 transition-shadow hover:shadow-md"
                >
                  <div className="bg-muted mb-4 inline-flex size-10 items-center justify-center rounded-lg">
                    <feature.icon className="size-5" />
                  </div>
                  <h3 className="font-display font-semibold">
                    {feature.title}
                  </h3>
                  <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
                    {feature.description}
                  </p>
                </Card>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="py-16">
          <div className="mx-auto max-w-5xl rounded-3xl border px-6 py-12 md:py-20 lg:py-32">
            <div className="text-center">
              <h2 className="text-balance font-serif text-4xl font-medium lg:text-5xl">
                Ready to experience Bella?
              </h2>
              <p className="text-muted-foreground mt-4">
                One call is all it takes. Try Bella now — available 24/7 in
                multiple languages.
              </p>

              <div className="mt-12 flex flex-wrap justify-center gap-4">
                <a
                  href="tel:+493075676653"
                  className={cn(buttonVariants({ size: 'lg' }))}
                >
                  <Phone className="mr-2 size-4" />
                  Call Bella Now
                </a>
                <Link
                  href="/login"
                  className={cn(
                    buttonVariants({ size: 'lg', variant: 'outline' })
                  )}
                >
                  Admin Login
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t py-8">
          <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-6 text-sm text-muted-foreground sm:flex-row">
            <p>&copy; 2026 SafeGuard Insurance</p>
            <p>
              Powered by{' '}
              <span className="font-display font-semibold text-foreground">
                Bella AI
              </span>
            </p>
          </div>
        </footer>
      </main>
    </>
  )
}
