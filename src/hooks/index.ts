import { useEffect, useState } from 'react';
import { fetchImage } from '../helpers';

export function useFetchImage(url: string, options?: RequestInit) {
  const [isCancel, setIsCancel] = useState(false);
  const [buf, setBuf] = useState<ArrayBuffer>(null);
  const [err, setErr] = useState<Error>(null);

  useEffect(() => {
    setBuf(null);
    setErr(null);
    setIsCancel(false);
    fetchImage(url, options)
      .then(buf => {
        if (isCancel) {
          return;
        }
        setBuf(buf);
      })
      .catch(err => {
        setErr(err);
      });
    return () => {
      setIsCancel(true);
    };
  }, [url]);
  return [buf, err] as const;
}
