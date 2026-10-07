@echo off
rem TPoker 一键启动（Windows）：启动本地服务并打印局域网访问信息
cd /d "%~dp0"

set PORT=8000

echo ============================================
echo   TPoker 本地服务启动中...
echo ============================================
echo.

rem 依次尝试可用的 Python 启动器
where py >nul 2>nul
if %errorlevel%==0 goto USE_PY
where python >nul 2>nul
if %errorlevel%==0 goto USE_PYTHON
where uv >nul 2>nul
if %errorlevel%==0 goto USE_UV
echo [错误] 未找到 Python。请先安装 Python 3，或安装 uv（https://docs.astral.sh/uv/）。
pause
exit /b 1

:USE_PY
set PYCMD=py -3
goto START
:USE_PYTHON
set PYCMD=python
goto START
:USE_UV
set PYCMD=uv run --no-project python
goto START

:START
rem 打印本机局域网 IPv4
echo 局域网地址（手机与电脑连同一 Wi-Fi 后访问其中一个）：
ipconfig | findstr /R "IPv4 192. 10. 172." | findstr /V "169.254"
echo.
echo 本机测试地址：  http://127.0.0.1:%PORT%/
echo.
echo 提示：
echo   1. iPhone Safari 打开上面的局域网地址
echo   2. 点"分享"按钮 -^> "添加到主屏幕"
echo   3. 之后从桌面图标打开即可完全离线使用
echo   4. 首次加载后应用自动缓存全部资源；内容更新需连同一 Wi-Fi 刷新一次
echo.
echo 按 Ctrl+C 停止服务。
echo.
%PYCMD% -m http.server %PORT% --bind 0.0.0.0
pause
