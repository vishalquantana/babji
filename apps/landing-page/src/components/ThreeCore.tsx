"use client";
import React, { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Points, PointMaterial } from "@react-three/drei";
import * as THREE from "three";

const generateParticles = (count: number) => {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
        const r = 2.5 * Math.cbrt(Math.random());
        const theta = Math.random() * 2 * Math.PI;
        const phi = Math.acos(2 * Math.random() - 1);

        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);
    }
    return positions;
};

const BrainParticles = () => {
    const ref = useRef<THREE.Points>(null);
    const positions = useMemo(() => generateParticles(4000), []);

    useFrame((state) => {
        if (ref.current) {
            ref.current.rotation.x = state.clock.elapsedTime * 0.1;
            ref.current.rotation.y = state.clock.elapsedTime * 0.15;

            // Follow mouse slightly
            ref.current.position.x = THREE.MathUtils.lerp(ref.current.position.x, (state.pointer.x * 0.5), 0.05);
            ref.current.position.y = THREE.MathUtils.lerp(ref.current.position.y, (state.pointer.y * 0.5), 0.05);
        }
    });

    return (
        <Points ref={ref} positions={positions} stride={3} frustumCulled={false}>
            <PointMaterial
                transparent
                color="#D8232A"
                size={0.035}
                sizeAttenuation={true}
                depthWrite={false}
                opacity={0.6}
            />
        </Points>
    );
};

export default function ThreeCore() {
    return (
        <div className="w-full h-full absolute inset-0 z-0 pointer-events-none">
            <Canvas camera={{ position: [0, 0, 5], fov: 60 }}>
                <ambientLight intensity={0.5} />
                <BrainParticles />
            </Canvas>
        </div>
    );
}
