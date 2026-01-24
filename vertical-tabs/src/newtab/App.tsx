import { useState } from 'react';

export default function App() {
  const [query, setQuery] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;

    // Check if it's a URL
    const isUrl = /^(https?:\/\/|www\.)/i.test(query) || 
                  /^[a-z0-9]+([\-\.]{1}[a-z0-9]+)*\.[a-z]{2,}(\/.*)?$/i.test(query);

    if (isUrl) {
      const url = query.startsWith('http') ? query : `https://${query}`;
      window.location.href = url;
    } else {
      // Search Google
      window.location.href = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8">
      <h1 className="text-4xl font-light text-gray-300 mb-8">
        New Tab
      </h1>
      
      <form onSubmit={handleSubmit} className="w-full max-w-xl">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search or enter URL..."
          autoFocus
          className="w-full px-6 py-4 text-lg bg-neutral-800 rounded-2xl
                     text-gray-200 placeholder-gray-500 outline-none
                     focus:ring-2 focus:ring-blue-500/50 transition-shadow"
        />
      </form>

      <p className="mt-6 text-sm text-gray-600">
        Press Enter to search or navigate
      </p>
    </div>
  );
}

