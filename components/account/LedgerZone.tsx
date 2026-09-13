'use client'

import { useMemo, useState } from 'react'
import Card from '@/components/shared/Card'
import Tag from '@/components/shared/Tag'
import Input from '@/components/shared/Input'
import Image from 'next/image'
import { getBrandAssets, creditsBrand } from '@/lib/brandAssets'
import type { AccountLedgerRow } from '@/types/account'
import type { ToolSlug } from '@/types/catalog'

type UsageFilter = 'credits' | 'allowance' | 'all'
type OutcomeFilter = 'success' | 'fail' | 'both'
type EntryKindFilter = 'all' | 'credits' | 'debits' | 'adjustments'

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function isAdjustment(row: AccountLedgerRow): boolean {
  return row.kind === 'funding' && (row.reasonLabel?.toLowerCase().includes('adjustment') ?? false)
}

function matchesUsage(row: AccountLedgerRow, filter: UsageFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'allowance') return row.kind === 'allowance-covered'
  return row.kind !== 'allowance-covered' // 'credits' — default view
}

function matchesOutcome(row: AccountLedgerRow, filter: OutcomeFilter): boolean {
  if (filter === 'both') return true
  if (row.outcome === null) return true // funding rows have no outcome — never filtered out by this axis
  return row.outcome === filter
}

function matchesEntryKind(row: AccountLedgerRow, filter: EntryKindFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'adjustments') return isAdjustment(row)
  if (filter === 'credits') return row.creditDelta > 0
  if (filter === 'debits') return row.creditDelta < 0
  return true
}

function matchesSearch(row: AccountLedgerRow, query: string): boolean {
  if (!query) return true
  return row.searchText.includes(query.toLowerCase())
}

function matchesDateRange(row: AccountLedgerRow, from: string, to: string): boolean {
  const createdAt = new Date(row.createdAt).getTime()
  if (from && createdAt < new Date(from).getTime()) return false
  if (to && createdAt > new Date(to).getTime() + 24 * 60 * 60 * 1000 - 1) return false
  return true
}

function RowIcon({ row }: { row: AccountLedgerRow }) {
  const asset = row.toolBrandSlug ? getBrandAssets(row.toolBrandSlug as ToolSlug) : creditsBrand
  return <Image src={asset.iconPng} alt="" height={28} width={28} className="rounded-md shrink-0" />
}

function CreditEffect({ row }: { row: AccountLedgerRow }) {
  if (row.kind === 'allowance-covered') return <Tag tone="neutral">Included · 0</Tag>
  if (row.creditDelta > 0) return <span className="text-green font-semibold">+{row.creditDelta}</span>
  if (row.creditDelta < 0) return <span className="text-red font-semibold">{row.creditDelta}</span>
  return <span className="text-silver">0</span>
}

function LedgerRow({ row }: { row: AccountLedgerRow }) {
  const label = row.toolName ?? row.reasonLabel ?? 'Ledger entry'
  const detail = row.activityLabel ?? row.reasonLabel

  return (
    <div className="flex items-center gap-3.5 py-3 border-b border-border-default last:border-b-0">
      <RowIcon row={row} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm truncate">{label}</span>
          {row.outcome === 'fail' && <Tag tone="red">Failed</Tag>}
        </div>
        <div className="text-xs text-silver truncate">
          {detail}
          {row.refId ? ` · ${row.refId}` : ''}
        </div>
      </div>

      <div className="text-xs text-silver hidden sm:block w-32 text-right shrink-0">{formatDate(row.createdAt)}</div>

      <div className="w-20 text-right shrink-0">
        <CreditEffect row={row} />
      </div>

      <div className="w-20 text-right shrink-0 text-xs text-silver">{row.balanceAfter}</div>
    </div>
  )
}

interface LedgerZoneProps {
  ledger: AccountLedgerRow[]
}

/**
 * ZONE 3 — filterable transaction history. `ledger` is the full, already
 * balance-annotated history (see lib/accountData.ts) — filtering here is
 * purely a display concern and never recomputes balanceAfter, so the
 * running-balance column stays correct even when filters narrow the visible set.
 *
 * FORWARD SEAM: no pending/reservation row kind exists in the schema yet
 * (bots charge-on-success reservations are a future bots-chat change). A
 * "pending/held" AccountLedgerRow kind can be added later purely as a new
 * render case here (RowIcon/CreditEffect/LedgerRow) — nothing about this
 * filtering logic needs to change to support it.
 */
export default function LedgerZone({ ledger }: LedgerZoneProps) {
  const [usage, setUsage] = useState<UsageFilter>('credits')
  const [outcome, setOutcome] = useState<OutcomeFilter>('success')
  const [entryKind, setEntryKind] = useState<EntryKindFilter>('all')
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const visibleRows = useMemo(
    () =>
      ledger.filter(
        (row) =>
          matchesUsage(row, usage) &&
          matchesOutcome(row, outcome) &&
          matchesEntryKind(row, entryKind) &&
          matchesSearch(row, search) &&
          matchesDateRange(row, dateFrom, dateTo),
      ),
    [ledger, usage, outcome, entryKind, search, dateFrom, dateTo],
  )

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Transaction history</h2>

      <Card className="flex flex-wrap items-end gap-4">
        <FilterSelect
          label="Usage"
          value={usage}
          onChange={(v) => setUsage(v as UsageFilter)}
          options={[
            { value: 'credits', label: 'Credits' },
            { value: 'allowance', label: 'Allowance' },
            { value: 'all', label: 'All' },
          ]}
        />
        <FilterSelect
          label="Outcome"
          value={outcome}
          onChange={(v) => setOutcome(v as OutcomeFilter)}
          options={[
            { value: 'success', label: 'Success' },
            { value: 'fail', label: 'Fail' },
            { value: 'both', label: 'Both' },
          ]}
        />
        <FilterSelect
          label="Entry kind"
          value={entryKind}
          onChange={(v) => setEntryKind(v as EntryKindFilter)}
          options={[
            { value: 'all', label: 'All' },
            { value: 'credits', label: 'Credits' },
            { value: 'debits', label: 'Debits' },
            { value: 'adjustments', label: 'Adjustments' },
          ]}
        />
        <div className="w-full sm:w-56">
          <Input
            label="Search"
            placeholder="Tool, reason, ref ID"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <div className="w-36">
            <Input label="From" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="w-36">
            <Input label="To" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
      </Card>

      <Card>
        {visibleRows.length === 0 ? (
          <p className="text-sm text-silver py-4 text-center">No transactions match these filters.</p>
        ) : (
          <div>
            {visibleRows.map((row) => (
              <LedgerRow key={row.id} row={row} />
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}

interface FilterSelectProps {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}

function FilterSelect({ label, value, onChange, options }: FilterSelectProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-sm font-medium text-white/80">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="bg-surface-2 text-white rounded-lg border border-white/10 focus:border-gold outline-none px-3 py-2.5 text-sm"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  )
}
