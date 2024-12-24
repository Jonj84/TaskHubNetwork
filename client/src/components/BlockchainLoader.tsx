import { motion } from "framer-motion";

interface BlockchainLoaderProps {
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function BlockchainLoader({ size = "md", className = "" }: BlockchainLoaderProps) {
  const sizeClass = {
    sm: "w-8 h-8",
    md: "w-12 h-12",
    lg: "w-16 h-16",
  }[size];

  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      {/* Outer rotating hexagon */}
      <motion.div
        className={`absolute ${sizeClass}`}
        animate={{
          rotate: 360,
        }}
        transition={{
          duration: 3,
          repeat: Infinity,
          ease: "linear",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          className="w-full h-full text-primary/20"
          strokeWidth="2"
        >
          <path d="M12 2L4 7V17L12 22L20 17V7L12 2Z" />
        </svg>
      </motion.div>

      {/* Inner pulsating token */}
      <motion.div
        className={`${sizeClass} scale-75`}
        animate={{
          scale: [0.7, 0.8, 0.7],
          opacity: [0.5, 1, 0.5],
        }}
        transition={{
          duration: 2,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className="w-full h-full text-primary"
        >
          <circle cx="12" cy="12" r="8" />
        </svg>
      </motion.div>

      {/* Loading dots */}
      <motion.div
        className="absolute -bottom-6 flex gap-1"
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{
          duration: 1.5,
          repeat: Infinity,
          ease: "easeInOut",
        }}
      >
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-primary"
            initial={{ opacity: 0.3 }}
            animate={{ opacity: 1 }}
            transition={{
              duration: 0.5,
              repeat: Infinity,
              repeatType: "reverse",
              delay: i * 0.2,
            }}
          />
        ))}
      </motion.div>
    </div>
  );
}
