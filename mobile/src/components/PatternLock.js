import React, { useRef, useState } from 'react'
import { View, PanResponder, StyleSheet, Dimensions } from 'react-native'
import Svg, { Line, Circle } from 'react-native-svg'

const GRID = 3
const HIT = 40
const WIDTH = Dimensions.get('window').width * 0.72
const CELL = WIDTH / GRID

function dotCenter(index) {
  const row = Math.floor(index / GRID)
  const col = index % GRID
  return { x: col * CELL + CELL / 2, y: row * CELL + CELL / 2 }
}

function hitTest(x, y) {
  for (let i = 0; i < GRID * GRID; i++) {
    const c = dotCenter(i)
    if (Math.hypot(x - c.x, y - c.y) < HIT) return i
  }
  return -1
}

export default function PatternLock({ onComplete, color = '#4f6ef7' }) {
  const [selected, setSelected] = useState([])
  const [finger, setFinger] = useState(null)
  const selectedRef = useRef([])
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponderCapture: () => true,

    onPanResponderGrant: (e) => {
      selectedRef.current = []
      setSelected([])
      setFinger(null)
      const { locationX: x, locationY: y } = e.nativeEvent
      const hit = hitTest(x, y)
      if (hit >= 0) {
        selectedRef.current = [hit]
        setSelected([hit])
      }
    },

    onPanResponderMove: (e) => {
      const { locationX: x, locationY: y } = e.nativeEvent
      setFinger({ x, y })
      const hit = hitTest(x, y)
      if (hit >= 0 && !selectedRef.current.includes(hit)) {
        selectedRef.current = [...selectedRef.current, hit]
        setSelected([...selectedRef.current])
      }
    },

    onPanResponderRelease: () => {
      setFinger(null)
      const seq = [...selectedRef.current]
      selectedRef.current = []
      setSelected([])
      if (seq.length >= 4) onCompleteRef.current(seq)
    },
  })).current

  return (
    <View style={{ width: WIDTH, height: WIDTH, alignSelf: 'center' }} {...panResponder.panHandlers}>
      <Svg width={WIDTH} height={WIDTH}>
        {selected.map((idx, i) => {
          if (i === 0) return null
          const from = dotCenter(selected[i - 1])
          const to = dotCenter(idx)
          return <Line key={`l${i}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y}
            stroke={color} strokeWidth="3" strokeOpacity="0.7" />
        })}
        {selected.length > 0 && finger && (
          <Line
            x1={dotCenter(selected[selected.length - 1]).x}
            y1={dotCenter(selected[selected.length - 1]).y}
            x2={finger.x} y2={finger.y}
            stroke={color} strokeWidth="3" strokeOpacity="0.4" />
        )}
        {Array.from({ length: 9 }, (_, i) => {
          const { x, y } = dotCenter(i)
          const active = selected.includes(i)
          return (
            <React.Fragment key={i}>
              <Circle cx={x} cy={y} r={active ? 14 : 8} fill={active ? color : '#555'} />
              {active && <Circle cx={x} cy={y} r={22} fill={color} fillOpacity="0.15" />}
            </React.Fragment>
          )
        })}
      </Svg>
    </View>
  )
}
