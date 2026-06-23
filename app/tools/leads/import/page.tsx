'use client'

import { useState, useRef, Suspense } from 'react'
import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import MinimalHeader from '@/components/tools/MinimalHeader'
import { useLocationId } from '@/lib/hooks/use-location-id'
import {
  cleanLeads,
  cleanDealMachineExport,
  detectFileFormat,
  formatDealMachineData,
  downloadCSV,
  type CleanedContact,
  type CleaningResult,
  type DealMachineContact,
  type DealMachineResult,
} from '@/lib/leadCleaner'

const GOLD = '#F5C842'
const ROWS_PER_PAGE = 25

function dateTag() {
  return new Date().toISOString().slice(0, 10)
}

// ─── BatchLeads Tab ───────────────────────────────────────────────────────────

function BatchLeadsTab({ locationId }: { locationId: string }) {
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState('')
  const [result, setResult] = useState<CleaningResult | null>(null)
  const [detectedFormat, setDetectedFormat] = useState<string>('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [processing, setProcessing] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ added: number; skipped: number; failed: number } | null>(null)
  const [showTagModal, setShowTagModal] = useState(false)
  const [tagName, setTagName] = useState('')
  const [page, setPage] = useState(0)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  function handleFileChoice(chosen: File) {
    const ext = chosen.name.split('.').pop()?.toLowerCase()
    if (ext !== 'csv' && ext !== 'xlsx') {
      setFileError('Only .csv and .xlsx files are supported.')
      return
    }
    setFileError('')
    setFile(chosen)
    setResult(null)
    setDetectedFormat('')
    setImportResult(null)
  }

  async function processFile() {
    if (!file) return
    setProcessing(true)
    try {
      const ext = file.name.split('.').pop()?.toLowerCase()
      let rows: string[][] = []

      if (ext === 'csv') {
        const text = await file.text()
        const parsed = Papa.parse<string[]>(text, { header: false, skipEmptyLines: true, delimiter: '' })
        rows = parsed.data as string[][]
      } else {
        const buf = await file.arrayBuffer()
        const wb = XLSX.read(buf)
        const ws = wb.Sheets[wb.SheetNames[0]]
        rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: '' }) as string[][]
      }

      if (rows.length < 2) {
        setFileError('File has no data rows.')
        setProcessing(false)
        return
      }

      const headers = rows[0].map(String)
      const dataRows = rows.slice(1).map((r) => r.map(String))

      // Auto-detect the export format and route to the matching cleaner
      const format = detectFileFormat(headers)
      let cleaned: CleaningResult
      if (format === 'dealmachine') {
        cleaned = cleanDealMachineExport(dataRows, headers)
        setDetectedFormat('DealMachine Export')
      } else if (format === 'batchleads') {
        cleaned = cleanLeads(dataRows, headers)
        setDetectedFormat('BatchLeads Export')
      } else {
        // Try BatchLeads as a fallback for unrecognized files
        cleaned = cleanLeads(dataRows, headers)
        setDetectedFormat('Unknown Format')
      }

      setResult(cleaned)
      setSelected(new Set(cleaned.contacts.map((_, i) => i)))
      setPage(0)
    } catch (e) {
      setFileError(`Failed to parse file: ${String(e)}`)
    }
    setProcessing(false)
  }

  function toggleAll() {
    if (!result) return
    if (selected.size === result.contacts.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(result.contacts.map((_, i) => i)))
    }
  }

  function toggleRow(i: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  function handleDownload() {
    if (!result) return
    const data = Array.from(selected).map((i) => {
      const c = result.contacts[i]
      return {
        'First Name': c.firstName,
        'Last Name': c.lastName,
        'Property Address': c.propertyAddress,
        City: c.city,
        State: c.state,
        Zip: c.zip,
        Phone: c.phone,
        Email: c.email,
      }
    })
    downloadCSV(data, `BatchLeads_Cleaned_${dateTag()}.csv`)
  }

  async function handleImport() {
    if (!result || selected.size === 0 || !tagName.trim()) return
    setImporting(true)
    setShowTagModal(false)
    const contacts = Array.from(selected).map((i) => result.contacts[i])
    const res = await fetch('/api/leads/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts, locationId, tag: tagName }),
    })
    const data = await res.json()
    setImportResult(data)
    setImporting(false)
  }

  const pageContacts = result
    ? result.contacts.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE)
    : []
  const totalPages = result ? Math.ceil(result.contacts.length / ROWS_PER_PAGE) : 0

  // ── Upload zone ──
  if (!result) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-6">
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const f = e.dataTransfer.files[0]
            if (f) handleFileChoice(f)
          }}
          onClick={() => inputRef.current?.click()}
          style={{
            border: `2px dashed ${dragging ? GOLD : 'rgba(245,200,66,0.4)'}`,
            borderRadius: 12,
            padding: '48px 24px',
            textAlign: 'center',
            cursor: 'pointer',
            background: dragging ? 'rgba(245,200,66,0.04)' : 'transparent',
            transition: 'all 0.15s',
          }}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFileChoice(f)
            }}
          />
          <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
          <p style={{ color: 'rgba(255,255,255,0.7)', marginBottom: 4 }}>
            Drag and drop your BatchLeads export here
          </p>
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
            or click to browse — .csv or .xlsx
          </p>
          {file && (
            <p style={{ color: GOLD, fontSize: 13, marginTop: 12 }}>
              {file.name} ({(file.size / 1024).toFixed(1)} KB)
            </p>
          )}
        </div>

        {fileError && (
          <p style={{ color: '#ef4444', fontSize: 13, marginTop: 8 }}>{fileError}</p>
        )}

        {file && !fileError && (
          <button
            onClick={processFile}
            disabled={processing}
            style={{
              marginTop: 20,
              background: GOLD,
              color: '#000',
              fontWeight: 700,
              padding: '12px 28px',
              borderRadius: 8,
              border: 'none',
              cursor: processing ? 'not-allowed' : 'pointer',
              opacity: processing ? 0.6 : 1,
              fontSize: 15,
            }}
          >
            {processing ? 'Processing…' : 'Process File →'}
          </button>
        )}
      </div>
    )
  }

  // ── Results ──
  return (
    <div className="px-6 py-8 max-w-7xl mx-auto">
      {/* File name + detected format badge */}
      {(file || detectedFormat) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
          {file && (
            <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14 }}>{file.name}</span>
          )}
          {detectedFormat && (
            <span style={{
              display: 'inline-block',
              background: 'rgba(255,255,255,0.08)',
              color: 'rgba(255,255,255,0.55)',
              borderRadius: 999,
              padding: '3px 10px',
              fontSize: 12,
            }}>
              Detected: {detectedFormat}
            </span>
          )}
        </div>
      )}

      {/* Stats bar */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${result.stats.dnc && result.stats.dnc > 0 ? 5 : 4},1fr)`,
        gap: 12,
        marginBottom: 24,
      }}>
        <StatCard label="Total Rows" value={result.stats.totalRows} color="rgba(255,255,255,0.5)" />
        <StatCard label="Mobile Found" value={result.stats.mobileFound} color={GOLD} />
        <StatCard label="Duplicates Removed" value={result.stats.duplicatesRemoved} color="rgba(255,255,255,0.5)" />
        {result.stats.dnc !== undefined && result.stats.dnc > 0 && (
          <StatCard label="DNC Removed" value={result.stats.dnc} color="#f59e0b" />
        )}
        <StatCard label="Ready to Import" value={result.stats.ready} color="#22c55e" />
      </div>

      {/* Import success */}
      {importResult && (
        <div style={{
          background: 'rgba(34,197,94,0.1)',
          border: '1px solid rgba(34,197,94,0.3)',
          borderRadius: 12,
          padding: '20px 24px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          flexWrap: 'wrap',
        }}>
          <span style={{ color: '#22c55e', fontWeight: 700, fontSize: 15 }}>
            ✓ {importResult.added} contacts added
          </span>
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>
            {importResult.skipped} already existed · {importResult.failed} failed
          </span>
          <button
            onClick={() => { setResult(null); setFile(null); setImportResult(null) }}
            style={{ marginLeft: 'auto', color: GOLD, background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14 }}
          >
            Import Another List
          </button>
        </div>
      )}

      {/* Table controls */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={toggleAll}
            style={{ color: 'rgba(255,255,255,0.5)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13 }}
          >
            {selected.size === result.contacts.length ? 'Deselect All' : 'Select All'}
          </button>
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
            {selected.size} of {result.contacts.length} selected
          </span>
        </div>
      </div>

      {/* Table */}
      <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {['', 'First Name', 'Last Name', 'Address', 'City', 'State', 'Zip', 'Phone', 'Email'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 14px', color: 'rgba(255,255,255,0.4)', fontWeight: 500, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageContacts.map((c, pageIdx) => {
                const absIdx = page * ROWS_PER_PAGE + pageIdx
                const checked = selected.has(absIdx)
                return (
                  <tr
                    key={absIdx}
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: checked ? 'rgba(245,200,66,0.03)' : 'transparent', cursor: 'pointer' }}
                    onClick={() => toggleRow(absIdx)}
                  >
                    <td style={{ padding: '9px 14px' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRow(absIdx)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ accentColor: GOLD }}
                      />
                    </td>
                    <td style={{ padding: '9px 14px', color: 'rgba(255,255,255,0.85)' }}>{c.firstName || <Dash />}</td>
                    <td style={{ padding: '9px 14px', color: 'rgba(255,255,255,0.85)' }}>{c.lastName || <Dash />}</td>
                    <td style={{ padding: '9px 14px', color: 'rgba(255,255,255,0.6)' }}>{c.propertyAddress || <Dash />}</td>
                    <td style={{ padding: '9px 14px', color: 'rgba(255,255,255,0.6)' }}>{c.city || <Dash />}</td>
                    <td style={{ padding: '9px 14px', color: 'rgba(255,255,255,0.6)' }}>{c.state || <Dash />}</td>
                    <td style={{ padding: '9px 14px', color: 'rgba(255,255,255,0.6)' }}>{c.zip || <Dash />}</td>
                    <td style={{ padding: '9px 14px', color: 'rgba(255,255,255,0.6)' }}>{c.phone || <Dash />}</td>
                    <td style={{ padding: '9px 14px', color: 'rgba(255,255,255,0.6)' }}>{c.email || <Dash />}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 0', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{ color: page === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.6)', background: 'transparent', border: 'none', cursor: page === 0 ? 'default' : 'pointer', fontSize: 13 }}
            >
              ← Prev
            </button>
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
              {page + 1} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              style={{ color: page === totalPages - 1 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.6)', background: 'transparent', border: 'none', cursor: page === totalPages - 1 ? 'default' : 'pointer', fontSize: 13 }}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => { setResult(null); setFile(null) }}
            style={{ color: 'rgba(255,255,255,0.5)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14 }}
          >
            ← Process Another File
          </button>
          <button
            onClick={handleDownload}
            disabled={selected.size === 0}
            style={{
              color: 'rgba(255,255,255,0.7)',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 8,
              padding: '8px 16px',
              cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
              fontSize: 14,
              opacity: selected.size === 0 ? 0.4 : 1,
            }}
          >
            Download CSV
          </button>
        </div>
        <button
          onClick={() => setShowTagModal(true)}
          disabled={selected.size === 0 || importing}
          style={{
            background: selected.size === 0 || importing ? 'rgba(245,200,66,0.4)' : GOLD,
            color: '#000',
            fontWeight: 700,
            padding: '10px 24px',
            borderRadius: 8,
            border: 'none',
            cursor: selected.size === 0 || importing ? 'not-allowed' : 'pointer',
            fontSize: 15,
          }}
        >
          {importing ? 'Importing…' : `Push to CRM →`}
        </button>
      </div>

      {/* Tag modal */}
      {showTagModal && (
        <TagModal
          count={selected.size}
          tagName={tagName}
          onTagChange={setTagName}
          onConfirm={handleImport}
          onCancel={() => setShowTagModal(false)}
        />
      )}
    </div>
  )
}

// ─── DealMachine Tab ──────────────────────────────────────────────────────────

function DealMachineTab({ locationId }: { locationId: string }) {
  const [rawText, setRawText] = useState('')
  const [result, setResult] = useState<DealMachineResult | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [showTagModal, setShowTagModal] = useState(false)
  const [tagName, setTagName] = useState('')
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<{ added: number; skipped: number; failed: number } | null>(null)
  const [page, setPage] = useState(0)
  const [tooltipOpen, setTooltipOpen] = useState(false)

  function handleFormat() {
    const formatted = formatDealMachineData(rawText)
    setResult(formatted)
    setSelected(new Set(formatted.contacts.map((_, i) => i)))
    setPage(0)
  }

  function toggleAll() {
    if (!result) return
    if (selected.size === result.contacts.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(result.contacts.map((_, i) => i)))
    }
  }

  function toggleRow(i: number) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  function handleDownload() {
    if (!result) return
    const data = Array.from(selected).map((i) => {
      const c = result.contacts[i]
      return { Address: c.address, City: c.city, State: c.state, Zip: c.zip }
    })
    downloadCSV(data, `DealMachine_${dateTag()}.csv`)
  }

  async function handleImport() {
    if (!result || selected.size === 0 || !tagName.trim()) return
    setImporting(true)
    setShowTagModal(false)
    const contacts = Array.from(selected).map((i) => result.contacts[i])
    const res = await fetch('/api/leads/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contacts, locationId, tag: tagName }),
    })
    const data = await res.json()
    setImportResult(data)
    setImporting(false)
  }

  const pageContacts = result
    ? result.contacts.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE)
    : []
  const totalPages = result ? Math.ceil(result.contacts.length / ROWS_PER_PAGE) : 0

  // ── Paste zone ──
  if (!result) {
    return (
      <div className="max-w-2xl mx-auto py-12 px-6">
        <textarea
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          placeholder={`Paste your DealMachine contacts here...\n\nExample:\n123 Main St\nView Lead\nAustin, TX 78701\n456 Oak Ave\nStart Mail\nDallas, TX 75201`}
          style={{
            width: '100%',
            minHeight: 240,
            background: '#111',
            color: 'rgba(255,255,255,0.85)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 10,
            padding: 16,
            fontSize: 13,
            fontFamily: 'monospace',
            resize: 'vertical',
            outline: 'none',
            boxSizing: 'border-box',
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = GOLD)}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'rgba(255,255,255,0.15)')}
        />
        <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12, marginTop: 4 }}>
          {rawText.length} characters
        </p>
        <button
          onClick={handleFormat}
          disabled={!rawText.trim()}
          style={{
            marginTop: 16,
            background: rawText.trim() ? GOLD : 'rgba(245,200,66,0.3)',
            color: '#000',
            fontWeight: 700,
            padding: '12px 28px',
            borderRadius: 8,
            border: 'none',
            cursor: rawText.trim() ? 'pointer' : 'not-allowed',
            fontSize: 15,
          }}
        >
          Format Contacts →
        </button>
      </div>
    )
  }

  // ── Results ──
  return (
    <div className="px-6 py-8 max-w-7xl mx-auto">
      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 24 }}>
        <StatCard label="Lines Processed" value={result.stats.totalLines} color="rgba(255,255,255,0.5)" />
        <StatCard label="Contacts Parsed" value={result.stats.parsed} color={GOLD} />
        <StatCard label="Junk Lines Skipped" value={result.stats.skipped} color="rgba(255,255,255,0.5)" />
      </div>

      {importResult && (
        <div style={{
          background: 'rgba(34,197,94,0.1)',
          border: '1px solid rgba(34,197,94,0.3)',
          borderRadius: 12,
          padding: '20px 24px',
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          flexWrap: 'wrap',
        }}>
          <span style={{ color: '#22c55e', fontWeight: 700, fontSize: 15 }}>
            ✓ {importResult.added} contacts added
          </span>
          <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14 }}>
            {importResult.skipped} already existed · {importResult.failed} failed
          </span>
          <button
            onClick={() => { setResult(null); setRawText(''); setImportResult(null) }}
            style={{ marginLeft: 'auto', color: GOLD, background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14 }}
          >
            Format Another List
          </button>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <button
            onClick={toggleAll}
            style={{ color: 'rgba(255,255,255,0.5)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 13 }}
          >
            {selected.size === result.contacts.length ? 'Deselect All' : 'Select All'}
          </button>
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>
            {selected.size} of {result.contacts.length} selected
          </span>
        </div>
      </div>

      <div style={{ background: '#111', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 12, overflow: 'hidden', marginBottom: 20 }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
                {['', 'Address', 'City', 'State', 'Zip'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '10px 14px', color: 'rgba(255,255,255,0.4)', fontWeight: 500 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pageContacts.map((c, pageIdx) => {
                const absIdx = page * ROWS_PER_PAGE + pageIdx
                const checked = selected.has(absIdx)
                return (
                  <tr
                    key={absIdx}
                    style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', background: checked ? 'rgba(245,200,66,0.03)' : 'transparent', cursor: 'pointer' }}
                    onClick={() => toggleRow(absIdx)}
                  >
                    <td style={{ padding: '9px 14px' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleRow(absIdx)}
                        onClick={(e) => e.stopPropagation()}
                        style={{ accentColor: GOLD }}
                      />
                    </td>
                    <td style={{ padding: '9px 14px', color: 'rgba(255,255,255,0.85)' }}>{c.address}</td>
                    <td style={{ padding: '9px 14px', color: 'rgba(255,255,255,0.6)' }}>{c.city}</td>
                    <td style={{ padding: '9px 14px', color: 'rgba(255,255,255,0.6)' }}>{c.state}</td>
                    <td style={{ padding: '9px 14px', color: 'rgba(255,255,255,0.6)' }}>{c.zip}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {totalPages > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 0', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <button
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0}
              style={{ color: page === 0 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.6)', background: 'transparent', border: 'none', cursor: page === 0 ? 'default' : 'pointer', fontSize: 13 }}
            >
              ← Prev
            </button>
            <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>{page + 1} / {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
              disabled={page === totalPages - 1}
              style={{ color: page === totalPages - 1 ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.6)', background: 'transparent', border: 'none', cursor: page === totalPages - 1 ? 'default' : 'pointer', fontSize: 13 }}
            >
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <button
            onClick={() => { setResult(null); setRawText('') }}
            style={{ color: 'rgba(255,255,255,0.5)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14 }}
          >
            ← Format Another List
          </button>
          <button
            onClick={handleDownload}
            disabled={selected.size === 0}
            style={{
              color: 'rgba(255,255,255,0.7)',
              background: 'transparent',
              border: '1px solid rgba(255,255,255,0.2)',
              borderRadius: 8,
              padding: '8px 16px',
              cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
              fontSize: 14,
              opacity: selected.size === 0 ? 0.4 : 1,
            }}
          >
            Download CSV
          </button>
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => window.open('https://app.batchleads.io')}
              onMouseEnter={() => setTooltipOpen(true)}
              onMouseLeave={() => setTooltipOpen(false)}
              style={{
                color: 'rgba(255,255,255,0.7)',
                background: 'transparent',
                border: '1px solid rgba(255,255,255,0.2)',
                borderRadius: 8,
                padding: '8px 16px',
                cursor: 'pointer',
                fontSize: 14,
              }}
            >
              Open BatchLeads
            </button>
            {tooltipOpen && (
              <div style={{
                position: 'absolute',
                bottom: 'calc(100% + 8px)',
                left: '50%',
                transform: 'translateX(-50%)',
                background: '#1a1a1a',
                border: '1px solid rgba(255,255,255,0.15)',
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 12,
                color: 'rgba(255,255,255,0.7)',
                whiteSpace: 'nowrap',
                zIndex: 10,
              }}>
                Upload your CSV to BatchLeads to skip trace,<br />
                then bring the export back here
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => setShowTagModal(true)}
          disabled={selected.size === 0 || importing}
          style={{
            background: selected.size === 0 || importing ? 'rgba(245,200,66,0.4)' : GOLD,
            color: '#000',
            fontWeight: 700,
            padding: '10px 24px',
            borderRadius: 8,
            border: 'none',
            cursor: selected.size === 0 || importing ? 'not-allowed' : 'pointer',
            fontSize: 15,
          }}
        >
          {importing ? 'Importing…' : 'Push Addresses to CRM →'}
        </button>
      </div>

      {showTagModal && (
        <TagModal
          count={selected.size}
          tagName={tagName}
          onTagChange={setTagName}
          onConfirm={handleImport}
          onCancel={() => setShowTagModal(false)}
        />
      )}
    </div>
  )
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

function Dash() {
  return <span style={{ color: 'rgba(255,255,255,0.2)' }}>—</span>
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{
      background: '#111',
      border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 10,
      padding: '14px 18px',
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)', marginTop: 2 }}>{label}</div>
    </div>
  )
}

function TagModal({
  count,
  tagName,
  onTagChange,
  onConfirm,
  onCancel,
}: {
  count: number
  tagName: string
  onTagChange: (v: string) => void
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100,
    }}>
      <div style={{
        background: '#141414',
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 16,
        padding: 32,
        width: '100%',
        maxWidth: 440,
      }}>
        <h3 style={{ color: '#fff', fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Name Your List</h3>
        <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, marginBottom: 20 }}>
          This becomes the GHL tag applied to all {count} contacts.
        </p>
        <input
          autoFocus
          type="text"
          value={tagName}
          onChange={(e) => onTagChange(e.target.value)}
          placeholder="e.g. El Paso Absentee Owners June 2026"
          onKeyDown={(e) => e.key === 'Enter' && tagName.trim() && onConfirm()}
          style={{
            width: '100%',
            background: '#1a1a1a',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 8,
            padding: '12px 14px',
            color: '#fff',
            fontSize: 14,
            outline: 'none',
            boxSizing: 'border-box',
            marginBottom: 20,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{ color: 'rgba(255,255,255,0.4)', background: 'transparent', border: 'none', cursor: 'pointer', fontSize: 14 }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={!tagName.trim()}
            style={{
              background: tagName.trim() ? GOLD : 'rgba(245,200,66,0.3)',
              color: '#000',
              fontWeight: 700,
              padding: '10px 20px',
              borderRadius: 8,
              border: 'none',
              cursor: tagName.trim() ? 'pointer' : 'not-allowed',
              fontSize: 14,
            }}
          >
            Import {count} Contacts →
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'batchleads' | 'dealMachine'

function ImportContent() {
  const locationId = useLocationId()
  const [tab, setTab] = useState<Tab>('dealMachine')

  return (
    <div style={{ minHeight: '100vh', background: '#000' }}>
      <MinimalHeader title="Lead Import" />

      {/* Tabs */}
      <div style={{
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        display: 'flex',
        paddingLeft: 24,
        gap: 0,
      }}>
        {([['dealMachine', 'DealMachine Formatter'], ['batchleads', 'BatchLeads Import']] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '14px 20px',
              fontSize: 14,
              fontWeight: tab === key ? 600 : 400,
              color: tab === key ? '#fff' : 'rgba(255,255,255,0.4)',
              borderBottom: tab === key ? `2px solid ${GOLD}` : '2px solid transparent',
              marginBottom: -1,
              transition: 'color 0.15s',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'dealMachine' ? (
        <DealMachineTab locationId={locationId} />
      ) : (
        <BatchLeadsTab locationId={locationId} />
      )}
    </div>
  )
}

export default function LeadImportPage() {
  return (
    <Suspense>
      <ImportContent />
    </Suspense>
  )
}
