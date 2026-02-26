import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

test('renders tool title', () => {
  render(<App />);
  const linkElement = screen.getByText(/コード分析ツール/i);
  expect(linkElement).toBeInTheDocument();
});
