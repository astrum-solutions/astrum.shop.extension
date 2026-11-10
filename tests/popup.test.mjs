// Вид окна, который ломается молча: стили, где сила селектора решает, отзовётся ли кнопка на курсор.
// Поведение окна (что оно показывает и делает) проверяют тесты сайта: окну нужен DOM, а здесь зависимостей нет.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { SRC } from './_harness.mjs'

const css = readFileSync(join(SRC, 'popup.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({
  selector: m[1].trim(),
  props: m[2].split(';').map((d) => d.split(':')[0].trim()).filter(Boolean),
}))

// Случай 11.11.2026: у кнопки «Войти» в списке было своё правило вида (`.mt .r.go { background… }`), и оно было
// СИЛЬНЕЕ общего отклика на курсор (`button.r:hover`): под курсором белело только слово, а кнопка не отзывалась; плюс
// она была у́же соседней «Скопировать». Теперь вид и ширина у кнопки строки одни, а у «Войти» своё только движение
// стрелки.
test('кнопка строки одна на все случаи: у «Войти» нет своего вида и своей ширины', () => {
  const own = rules.filter((r) => /\.go(?![\w-])/.test(r.selector))
  // Положительный контроль: правило у «Войти» есть, и класс в стилях — тот же, что ставит окно.
  assert.ok(own.length >= 1, 'правила для .go не нашлись — тест смотрит не туда')
  assert.ok(readFileSync(join(SRC, 'popup.js'), 'utf8').includes('class="r go"'))
  for (const rule of own) assert.deepEqual(rule.props.filter((p) => p !== 'transform'), [], `свой вид у «Войти»: ${rule.selector}`)
  // Ширина одна на все слова («Скопировать», «Войти», «Читаем…», «Скопировано», «Не вышло»): кнопка не дышит.
  const base = rules.find((r) => r.selector === '.mt .r')
  assert.ok(base, 'общее правило кнопки строки не нашлось')
  assert.ok(base.props.includes('width'))
  assert.equal(base.props.includes('min-width'), false)
  // Отклик на курсор — общий и не слабее вида: вид задан двумя классами, отклик — тегом, классом и :hover.
  assert.ok(rules.some((r) => r.selector === 'button.r:hover' && r.props.includes('background') && r.props.includes('box-shadow')))
})
