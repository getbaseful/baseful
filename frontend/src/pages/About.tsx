import { Link } from 'react-router-dom'

export default function About() {
    return (
        <div className="container">
            <h1>About Page</h1>
            <p>This is a simple About page to demonstrate React Router functionality.</p>

            <div style={{ marginTop: '2rem', padding: '1.5rem', background: 'rgba(255, 255, 255, 0.05)', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <p>You successfully navigated here using React Router!</p>
            </div>

            <nav style={{ marginTop: '2rem' }}>
                <Link to="/" style={{ padding: '0.5rem 1rem', background: '#646cff', color: 'white', borderRadius: '8px', textDecoration: 'none' }}>
                    Back to Home
                </Link>
            </nav>
        </div>
    )
}
