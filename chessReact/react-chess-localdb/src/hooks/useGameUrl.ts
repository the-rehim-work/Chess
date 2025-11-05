import { useState, useEffect } from 'react';

export function useGameUrl() {
  const [code, setCodeState] = useState<string | null>(null);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const codeFromUrl = urlParams.get('code');
    setCodeState(codeFromUrl);
  }, []);

  const setCode = (newCode: string) => {
    const url = new URL(window.location.href);
    if (newCode) {
      url.searchParams.set('code', newCode);
    } else {
      url.searchParams.delete('code');
    }
    window.history.replaceState({}, '', url.toString());
    setCodeState(newCode);
  };

  const clearCode = () => {
    setCode('');
  };

  return { code, setCode, clearCode };
}