import { useEffect } from 'react'
import html from 'virtual:world-whitepaper'
import 'katex/dist/katex.min.css'
import './whitepaper.css'

export default function WhitepaperPage() {
  useEffect(() => {
    document.title = 'WORLD — Whitepaper v1.0'
    document.documentElement.lang = 'en'
    if (location.hash) document.getElementById(decodeURIComponent(location.hash.slice(1)))?.scrollIntoView()
  }, [])
  return <div className="app-shell whitepaper-shell" lang="en">
    <header className="whitepaper-header">
      <a className="wordmark" href="/" aria-label="Back to WORLD">WORLD</a>
      <a className="button secondary" href="https://github.com/burn-the-world/world-public/blob/main/docs/WHITEPAPER.md" target="_blank" rel="noopener noreferrer">View source on GitHub</a>
    </header>
    <main className="whitepaper-content" aria-label="WORLD Whitepaper v1.0" dangerouslySetInnerHTML={{ __html: html }}/>
    <footer className="whitepaper-footer"><a href="/">Back to WORLD</a><a href="#world">Back to top ↑</a></footer>
  </div>
}
