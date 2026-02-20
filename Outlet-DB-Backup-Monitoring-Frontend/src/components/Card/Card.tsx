import React from "react";

interface CardProps {
  title: string;
  value: number | string;
  children?: React.ReactNode;

}

const Card: React.FC<CardProps> = ({ title, value,children}) => (
  <div className="border rounded-lg p-4 shadow-md">
    <h3 className="text-xl font-semibold">{title}</h3>
    <p className="text-2xl font-bold">{value}</p>
    <div className="mt-2">{children}</div>
  </div>
);

export default Card;
