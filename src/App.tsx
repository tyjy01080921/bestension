import { useState } from 'react'
import HomeScreen from './screens/HomeScreen'
import AddRacketScreen from './screens/AddRacketScreen'
import RecordScreen from './screens/RecordScreen'
import CompareScreen from './screens/CompareScreen'
import PWAUpdatePrompt from './components/PWAUpdatePrompt'
import type { Racket } from './db'

type Screen =
  | { id: 'home' }
  | { id: 'add' }
  | { id: 'record'; racket: Racket }
  | { id: 'compare'; racket: Racket }

export default function App() {
  const [screen, setScreen] = useState<Screen>({ id: 'home' })

  const go = (s: Screen) => setScreen(s)

  const renderScreen = () => {
    switch (screen.id) {
      case 'home':
        return (
          <HomeScreen
            onAddRacket={() => go({ id: 'add' })}
            onRecord={r => go({ id: 'record', racket: r })}
            onCompare={r => go({ id: 'compare', racket: r })}
          />
        )
      case 'add':
        return (
          <AddRacketScreen
            onBack={() => go({ id: 'home' })}
            onSaved={r => go({ id: 'record', racket: r })}
          />
        )
      case 'record':
        return (
          <RecordScreen
            racket={screen.racket}
            onBack={() => go({ id: 'home' })}
            onSaved={() => go({ id: 'home' })}
          />
        )
      case 'compare':
        return (
          <CompareScreen
            racket={screen.racket}
            onBack={() => go({ id: 'home' })}
          />
        )
    }
  }

  return (
    <>
      {renderScreen()}
      <PWAUpdatePrompt />
    </>
  )
}
