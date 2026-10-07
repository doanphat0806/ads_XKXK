import React from 'react';
import { ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';

export default function ToastLayer() {
  return <ToastContainer position="bottom-right" autoClose={3000} hideProgressBar theme="dark" />;
}
