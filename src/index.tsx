import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { useFetchImage } from './hooks';
import { png } from './parser';
import styled from 'styled-components';

const ImageBox = styled.div`
  flex-wrap: wrap;
  display: flex;
`;

const Pixel = styled.div`
  width: 1px;
  height: 1px;
`;

function PNGImageRender({ url }: { url: string }) {
  const [buf, err] = useFetchImage(url);
  const [PNG, setPNG] = useState<ReturnType<typeof png>>(null);

  useEffect(() => {
    if (!buf) {
      return;
    }

    setPNG(png(new Uint8Array(buf)));
  }, [buf]);

  return (
    <>
      {PNG ? (
        <ImageBox style={{ height: PNG.IHDR.height, width: PNG.IHDR.width }}>
          {PNG.pixels.map((p, i) => (
            <Pixel
              title={`x: ${p.position.x}, y: ${p.position.y}`}
              key={i}
              style={{
                backgroundColor: `rgba(${p.color.red}, ${p.color.green}, ${
                  p.color.blue
                }, ${p.color.alpha})`,
              }}
            />
          ))}
        </ImageBox>
      ) : err ? (
        <p>{err.message}</p>
      ) : (
        <p>Loading...</p>
      )}
      <img src={url} />
    </>
  );
}

ReactDOM.render(
  <>
    <PNGImageRender url="./assets/sample.png" />
    <br />
    {/* <PNGImageRender url="./assets/peng.png" />
    <br />
    <PNGImageRender url="./assets/grayscale.png" />
    <br />
    <PNGImageRender url="./assets/alpha.png" /> */}
  </>,
  document.getElementById('root')
);
