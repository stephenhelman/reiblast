'use client'

import { useState, useEffect, Suspense } from 'react'
import Input from '@/components/shared/Input'
import { useLocationId } from '@/lib/hooks/use-location-id'
import Button from '@/components/shared/Button'
import MinimalHeader from '@/components/tools/MinimalHeader'

interface ServiceState {
  apiKey: string
  connected: boolean
}

interface Lead {
  ownerName: string
  propertyAddress: string
  mailingAddress: string
  phone: string
  status: string
}

const PROPERTY_TYPES = ['All', 'SFR', 'MFR', 'Land', 'Commercial']

function LeadsContent() {
  const locationId = useLocationId()
  void locationId // passed to API calls when lead import is wired up

  const [dealMachine, setDealMachine] = useState<ServiceState>({ apiKey: '', connected: false })
  const [batchLeads, setBatchLeads] = useState<ServiceState>({ apiKey: '', connected: false })
  const [market, setMarket] = useState('')
  const [propertyType, setPropertyType] = useState('All')
  const [listSize, setListSize] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [listPulled, setListPulled] = useState(false)

  const anyConnected = dealMachine.connected || batchLeads.connected

  useEffect(() => {
    const dm = localStorage.getItem('wos_dm_connected')
    const bl = localStorage.getItem('wos_bl_connected')
    const dmKey = localStorage.getItem('wos_dm_key') ?? ''
    const blKey = localStorage.getItem('wos_bl_key') ?? ''
    if (dm === 'true') setDealMachine({ apiKey: dmKey, connected: true })
    if (bl === 'true') setBatchLeads({ apiKey: blKey, connected: true })
  }, [])

  function connectService(service: 'dm' | 'bl') {
    if (service === 'dm') {
      localStorage.setItem('wos_dm_connected', 'true')
      localStorage.setItem('wos_dm_key', dealMachine.apiKey)
      setDealMachine((s) => ({ ...s, connected: true }))
    } else {
      localStorage.setItem('wos_bl_connected', 'true')
      localStorage.setItem('wos_bl_key', batchLeads.apiKey)
      setBatchLeads((s) => ({ ...s, connected: true }))
    }
  }

  function disconnectService(service: 'dm' | 'bl') {
    if (service === 'dm') {
      localStorage.removeItem('wos_dm_connected')
      localStorage.removeItem('wos_dm_key')
      setDealMachine({ apiKey: '', connected: false })
    } else {
      localStorage.removeItem('wos_bl_connected')
      localStorage.removeItem('wos_bl_key')
      setBatchLeads({ apiKey: '', connected: false })
    }
  }

  function pullList() {
    const count = Math.min(parseInt(listSize) || 10, 500)
    const mocked: Lead[] = Array.from({ length: Math.min(count, 5) }, (_, i) => ({
      ownerName: `Owner ${i + 1}`,
      propertyAddress: `${1000 + i} ${market || 'Main'} St`,
      mailingAddress: `PO Box ${i + 1}, ${market || 'Dallas'} TX`,
      phone: `(555) ${String(100 + i).padStart(3, '0')}-0000`,
      status: 'New Lead',
    }))
    setLeads(mocked)
    setListPulled(true)
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      {/* Connection cards */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        <div className="bg-surface border border-border-default rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-white font-semibold text-lg">DealMachine</h2>
            {dealMachine.connected && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-green-400 bg-green-400/10 border border-green-400/20 px-3 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400" />Connected
              </span>
            )}
          </div>
          <p className="text-white/40 text-sm mb-4">Pull skip-traced lists from DealMachine directly into your pipeline.</p>
          {!dealMachine.connected ? (
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="DealMachine API key"
                value={dealMachine.apiKey}
                onChange={(e) => setDealMachine((s) => ({ ...s, apiKey: e.target.value }))}
                className="flex-1 bg-surface-2 text-white text-sm rounded-lg border border-white/10 focus:border-gold px-3 py-2.5 outline-none placeholder:text-white/30"
              />
              <Button variant="outline" size="sm" onClick={() => connectService('dm')} disabled={!dealMachine.apiKey}>Connect</Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => disconnectService('dm')}>Disconnect</Button>
          )}
        </div>

        <div className="bg-surface border border-border-default rounded-xl p-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-white font-semibold text-lg">BatchLeads</h2>
            {batchLeads.connected && (
              <span className="flex items-center gap-1.5 text-xs font-medium text-green-400 bg-green-400/10 border border-green-400/20 px-3 py-1 rounded-full">
                <span className="w-1.5 h-1.5 rounded-full bg-green-400" />Connected
              </span>
            )}
          </div>
          <p className="text-white/40 text-sm mb-4">Access BatchLeads&apos; skip-tracing and list-building tools.</p>
          {!batchLeads.connected ? (
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="BatchLeads API key"
                value={batchLeads.apiKey}
                onChange={(e) => setBatchLeads((s) => ({ ...s, apiKey: e.target.value }))}
                className="flex-1 bg-surface-2 text-white text-sm rounded-lg border border-white/10 focus:border-gold px-3 py-2.5 outline-none placeholder:text-white/30"
              />
              <Button variant="outline" size="sm" onClick={() => connectService('bl')} disabled={!batchLeads.apiKey}>Connect</Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" onClick={() => disconnectService('bl')}>Disconnect</Button>
          )}
        </div>
      </div>

      {/* Search panel */}
      <div className={`bg-surface border border-border-default rounded-xl p-6 mb-6 ${!anyConnected ? 'opacity-40 pointer-events-none' : ''}`}>
        {!anyConnected && (
          <div className="flex items-center gap-2 mb-4 text-gold text-sm">
            <span>🔒</span>
            <span>Connect at least one list provider above to search.</span>
          </div>
        )}
        <div className="grid md:grid-cols-3 gap-4 mb-4">
          <Input label="Market / Zip Code" type="text" placeholder="75201 or Dallas, TX" value={market} onChange={(e) => setMarket(e.target.value)} />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-white/80">Property Type</label>
            <select
              value={propertyType}
              onChange={(e) => setPropertyType(e.target.value)}
              className="bg-surface-2 text-white rounded-lg border border-white/10 focus:border-gold px-4 py-3 outline-none transition-colors"
            >
              {PROPERTY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <Input label="List Size (max 500)" type="number" placeholder="100" value={listSize} onChange={(e) => setListSize(e.target.value)} />
        </div>
        <Button variant="primary" size="md" onClick={pullList} disabled={!anyConnected || !market}>Pull List</Button>
      </div>

      {/* Results table */}
      <div className="bg-surface border border-border-default rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-default">
          <h2 className="text-white font-semibold">Results</h2>
          {leads.length > 0 && (
            <div className="group relative">
              <Button variant="outline" size="sm" disabled>Import Selected</Button>
              <div className="absolute bottom-full right-0 mb-2 hidden group-hover:block">
                <div className="bg-surface border border-border-default text-white/70 text-xs px-3 py-2 rounded-lg whitespace-nowrap">🔒 CRM Sync required</div>
              </div>
            </div>
          )}
        </div>

        {!listPulled ? (
          <div className="px-6 py-16 text-center text-white/30">Pull a list above to see results</div>
        ) : leads.length === 0 ? (
          <div className="px-6 py-16 text-center text-white/30">No leads found for that search.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default">
                  <th className="text-left px-6 py-3 text-white/40 font-medium"><input type="checkbox" className="accent-gold" /></th>
                  {['Owner Name', 'Property Address', 'Mailing Address', 'Phone', 'Status', 'Actions'].map((h) => (
                    <th key={h} className="text-left px-6 py-3 text-white/40 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leads.map((lead, i) => (
                  <tr key={i} className="border-b border-border-default hover:bg-white/2 transition-colors">
                    <td className="px-6 py-4"><input type="checkbox" className="accent-gold" /></td>
                    <td className="px-6 py-4 text-white">{lead.ownerName}</td>
                    <td className="px-6 py-4 text-white/70">{lead.propertyAddress}</td>
                    <td className="px-6 py-4 text-white/70">{lead.mailingAddress}</td>
                    <td className="px-6 py-4 text-white/70">{lead.phone}</td>
                    <td className="px-6 py-4">
                      <span className="text-xs bg-gold/10 text-gold border border-gold/20 px-2 py-1 rounded-full">{lead.status}</span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="group relative inline-block">
                        <button disabled className="text-xs border border-gold/40 text-gold/40 px-3 py-1.5 rounded-lg cursor-not-allowed">🔒 Import</button>
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block">
                          <div className="bg-surface border border-border-default text-white/70 text-xs px-3 py-2 rounded-lg whitespace-nowrap">CRM Sync coming soon</div>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-white/30 text-xs mt-4 flex items-center gap-2">
        <span>ℹ</span>
        Imported leads will be tagged <span className="text-gold">New Lead</span> in your REIblast CRM automatically.
      </p>
    </div>
  )
}

export default function LeadsPage() {
  return (
    <div className="min-h-screen bg-black">
      <MinimalHeader title="Lead Sourcing" />
      <Suspense>
        <LeadsContent />
      </Suspense>
    </div>
  )
}
